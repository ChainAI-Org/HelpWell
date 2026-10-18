/**
 * Giveaways: entries, referral bonuses, self-reported bonus actions, and a
 * draw anyone can check.
 *
 * One entry per person per giveaway, keyed on the email. Each entrant gets a
 * referral code; a trusted person who enters through `?ref=CODE` earns the
 * referrer the giveaway's referral bonus, and an untrusted one earns nothing
 * (the referral is still recorded, uncredited). Bonus actions ("follow us")
 * cannot be checked, so they are self-reported and labelled so. An entry's
 * total never passes the giveaway's cap.
 *
 * The draw weighs each eligible entry (trusted, not disqualified, not drawn
 * before) by its total, and picks with a generator seeded by a value that is
 * recorded, over a list of entries whose hash is recorded too: given the
 * seed and the same entries, anyone gets the same winners. A redraw marks
 * the winner as redrawn with a reason and draws a replacement the same way.
 * Nothing in `giveaway_winners` is ever deleted; it is the audit log.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { HelpWellError } from '../errors.js';
import { idPrefix, newId } from '../ids.js';
import type { Form, GiveawaySettings } from './schema.js';
import { signEntryKey } from './tokens.js';

export interface GiveawayEntry {
  id: string;
  formId: string;
  submissionId: string;
  contactId: string | null;
  email: string;
  referralCode: string;
  referredBy: string | null;
  trusted: boolean;
  disqualified: boolean;
  bonusReferrals: number;
  bonusActions: number;
  entries: number;
  actions: string[];
  createdAt: Date;
}

type EntryRow = {
  id: string;
  form_id: string;
  submission_id: string;
  contact_id: string | null;
  email: string;
  referral_code: string;
  referred_by: string | null;
  trusted: boolean;
  disqualified: boolean;
  bonus_referrals: number | string;
  bonus_actions: number | string;
  entries: number | string;
  actions: unknown;
  created_at: string | Date;
};

const ENTRY_COLUMNS = sql`id, form_id, submission_id, contact_id, email, referral_code, referred_by,
  trusted, disqualified, bonus_referrals, bonus_actions, entries, actions, created_at`;

function toEntry(row: EntryRow): GiveawayEntry {
  const actions = typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions;
  return {
    id: row.id,
    formId: row.form_id,
    submissionId: row.submission_id,
    contactId: row.contact_id,
    email: row.email,
    referralCode: row.referral_code,
    referredBy: row.referred_by,
    trusted: Boolean(row.trusted),
    disqualified: Boolean(row.disqualified),
    bonusReferrals: Number(row.bonus_referrals),
    bonusActions: Number(row.bonus_actions),
    entries: Number(row.entries),
    actions: Array.isArray(actions) ? actions.map(String) : [],
    createdAt: new Date(row.created_at),
  };
}

/** One person's total: their own entry, plus bonuses, never over the cap. */
export function entryTotal(
  giveaway: Pick<GiveawaySettings, 'maxEntries' | 'referralEntries'>,
  entry: Pick<GiveawayEntry, 'bonusReferrals' | 'bonusActions'>,
): number {
  return Math.min(
    giveaway.maxEntries,
    1 + entry.bonusReferrals * giveaway.referralEntries + entry.bonusActions,
  );
}

/** Whether the giveaway takes entries at this moment. */
export function giveawayOpen(
  giveaway: GiveawaySettings,
  now: Date,
): 'open' | 'not_started' | 'ended' {
  if (giveaway.startsAt && now.getTime() < Date.parse(giveaway.startsAt)) return 'not_started';
  if (giveaway.endsAt && now.getTime() >= Date.parse(giveaway.endsAt)) return 'ended';
  return 'open';
}

export async function getEntry(db: Db, id: string): Promise<GiveawayEntry | null> {
  const row = rowsOf<EntryRow>(
    await db.execute(sql`SELECT ${ENTRY_COLUMNS} FROM helpwell.giveaway_entries WHERE id = ${id}`),
  )[0];
  return row ? toEntry(row) : null;
}

/** This person's entry in a giveaway, by email or contact. */
export async function findEntry(
  db: Db,
  formId: string,
  who: { email?: string | null; contactId?: string | null },
): Promise<GiveawayEntry | null> {
  if (!who.email && !who.contactId) return null;
  const row = rowsOf<EntryRow>(
    await db.execute(sql`
      SELECT ${ENTRY_COLUMNS} FROM helpwell.giveaway_entries
      WHERE form_id = ${formId} AND (
        ${who.email ? sql`lower(email) = ${who.email.toLowerCase()}` : sql`FALSE`}
        OR ${who.contactId ? sql`contact_id = ${who.contactId}` : sql`FALSE`}
      )
      ORDER BY created_at LIMIT 1
    `),
  )[0];
  return row ? toEntry(row) : null;
}

function referralCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export interface EnterResult {
  entry: GiveawayEntry;
  /** The referrer this entry credited, when it did. */
  credited: GiveawayEntry | null;
}

/**
 * Enter one accepted submission. `ref` is the referral code on the page it
 * came from; it credits its owner only when this entry is trusted, is a
 * different person, and is a new entry.
 */
export async function enterGiveaway(
  db: Db,
  form: Form,
  input: {
    submissionId: string;
    contactId: string | null;
    email: string;
    trusted: boolean;
    ref?: string | null;
    now?: Date;
  },
): Promise<EnterResult> {
  const giveaway = form.definition.giveaway;
  const email = input.email.toLowerCase();
  const existing = await findEntry(db, form.id, { email });
  if (existing) return { entry: existing, credited: null };

  const referrer =
    input.ref && /^[a-z0-9]{4,20}$/.test(input.ref)
      ? rowsOf<EntryRow>(
          await db.execute(sql`
            SELECT ${ENTRY_COLUMNS} FROM helpwell.giveaway_entries
            WHERE form_id = ${form.id} AND referral_code = ${input.ref}
          `),
        ).map(toEntry)[0]
      : undefined;
  const selfReferral =
    referrer &&
    (referrer.email.toLowerCase() === email ||
      (input.contactId !== null && referrer.contactId === input.contactId));
  const from = referrer && !selfReferral ? referrer : null;
  const now = (input.now ?? new Date()).toISOString();

  const id = newId(idPrefix.entry);
  let inserted = false;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const rows = rowsOf<{ id: string }>(
      await db.execute(sql`
        INSERT INTO helpwell.giveaway_entries
          (id, form_id, submission_id, contact_id, email, referral_code, referred_by, trusted,
           entries, created_at, updated_at)
        VALUES (${id}, ${form.id}, ${input.submissionId}, ${input.contactId}, ${email},
                ${referralCode()}, ${from?.id ?? null}, ${input.trusted}, 1,
                ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING id
      `),
    );
    if (rows.length > 0) {
      inserted = true;
      break;
    }
    // The person entered a moment ago in another tab: theirs stands.
    const raced = await findEntry(db, form.id, { email });
    if (raced) return { entry: raced, credited: null };
    // Otherwise the referral code collided; another draw of it.
  }
  if (!inserted) throw new Error('Could not make a unique referral code');

  let credited: GiveawayEntry | null = null;
  if (from) {
    const credit = input.trusted;
    await db.execute(sql`
      INSERT INTO helpwell.giveaway_referrals
        (id, form_id, referrer_entry_id, referred_entry_id, credited, created_at)
      VALUES (${newId(idPrefix.referral)}, ${form.id}, ${from.id}, ${id}, ${credit}, ${now}::timestamptz)
      ON CONFLICT (referred_entry_id) DO NOTHING
    `);
    if (credit) {
      await db.execute(sql`
        UPDATE helpwell.giveaway_entries SET
          bonus_referrals = bonus_referrals + 1,
          entries = LEAST(${giveaway.maxEntries},
            1 + (bonus_referrals + 1) * ${giveaway.referralEntries} + bonus_actions),
          updated_at = ${now}::timestamptz
        WHERE id = ${from.id}
      `);
      credited = await getEntry(db, from.id);
    }
  }
  return { entry: (await getEntry(db, id))!, credited };
}

/**
 * Claim a self-reported bonus action once. Only for a trusted entry: an
 * untrusted one does not count in the draw anyway.
 */
export async function claimBonusAction(
  db: Db,
  form: Form,
  entryId: string,
  actionId: string,
): Promise<GiveawayEntry> {
  const giveaway = form.definition.giveaway;
  const action = giveaway.actions.find((a) => a.id === actionId);
  if (!action) throw new HelpWellError('not_found', `No bonus action ${actionId}`);
  const entry = await getEntry(db, entryId);
  if (!entry || entry.formId !== form.id) throw new HelpWellError('not_found', 'No such entry');
  if (entry.actions.includes(action.id) || !entry.trusted || entry.disqualified) return entry;
  await db.execute(sql`
    UPDATE helpwell.giveaway_entries SET
      actions = actions || ${JSON.stringify([action.id])}::jsonb,
      bonus_actions = bonus_actions + ${action.entries},
      entries = LEAST(${giveaway.maxEntries},
        1 + bonus_referrals * ${giveaway.referralEntries} + bonus_actions + ${action.entries}),
      updated_at = now()
    WHERE id = ${entry.id} AND NOT (actions ? ${action.id})
  `);
  return (await getEntry(db, entry.id))!;
}

/** What the entrant is shown: their total, their link's code, their actions. */
export interface EntryState {
  entryId: string;
  /** Signed: what claiming a bonus action proves ownership with. */
  entryKey: string;
  entries: number;
  maxEntries: number;
  referralCode: string;
  /** Trusted people who entered through their link. */
  referrals: number;
  referralEntries: number;
  actions: {
    id: string;
    kind: 'visit' | 'follow';
    label: string;
    url: string;
    entries: number;
    done: boolean;
  }[];
}

export async function entryState(db: Db, form: Form, entry: GiveawayEntry): Promise<EntryState> {
  const giveaway = form.definition.giveaway;
  return {
    entryId: entry.id,
    entryKey: await signEntryKey(db, entry.id),
    entries: entry.entries,
    maxEntries: giveaway.maxEntries,
    referralCode: entry.referralCode,
    referrals: entry.bonusReferrals,
    referralEntries: giveaway.referralEntries,
    actions: giveaway.actions.map((action) => ({
      id: action.id,
      kind: action.kind,
      label: action.label,
      url: action.url,
      entries: action.entries,
      done: entry.actions.includes(action.id),
    })),
  };
}

/* ------------------------------------------------------------------ draws */

export interface GiveawayWinner {
  id: string;
  drawId: string;
  entryId: string;
  email: string;
  contactId: string | null;
  entries: number;
  position: number;
  seed: string;
  snapshotHash: string;
  snapshotSize: number;
  totalWeight: number;
  status: 'selected' | 'redrawn';
  reason: string | null;
  replacedBy: string | null;
  replaces: string | null;
  createdAt: Date;
  redrawnAt: Date | null;
}

export interface Draw {
  drawId: string;
  seed: string;
  snapshotHash: string;
  snapshotSize: number;
  totalWeight: number;
  winners: GiveawayWinner[];
}

interface Candidate {
  id: string;
  weight: number;
}

/**
 * The entries a draw may pick from, in a fixed order: trusted, not
 * disqualified, and never drawn before (a redrawn winner is not drawn again).
 */
async function eligibleEntries(db: Db, formId: string): Promise<Candidate[]> {
  const rows = rowsOf<{ id: string; entries: number | string }>(
    await db.execute(sql`
      SELECT e.id, e.entries FROM helpwell.giveaway_entries e
      WHERE e.form_id = ${formId} AND e.trusted AND NOT e.disqualified
        AND NOT EXISTS (
          SELECT 1 FROM helpwell.giveaway_winners w
          WHERE w.form_id = e.form_id AND w.entry_id = e.id
        )
      ORDER BY e.id
    `),
  );
  return rows.map((row) => ({ id: row.id, weight: Math.max(1, Number(row.entries)) }));
}

/** SHA-256, hex. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hash a draw records: every eligible entry and its weight, one per line, in order. */
export function snapshotText(candidates: readonly Candidate[]): string {
  return candidates.map((c) => `${c.id}:${c.weight}`).join('\n');
}

/** A number in [0, 1) from the seed and a counter: the same inputs, the same number. */
async function uniform(seed: string, round: number): Promise<number> {
  const hex = await sha256(`${seed}:${round}`);
  // 48 bits is exact in a double and far more than any draw needs.
  return Number.parseInt(hex.slice(0, 12), 16) / 2 ** 48;
}

/** Weighted picks without replacement, deterministic given the seed. */
export async function weightedPicks(
  candidates: readonly Candidate[],
  count: number,
  seed: string,
): Promise<Candidate[]> {
  const pool = [...candidates];
  const picked: Candidate[] = [];
  for (let round = 0; round < count && pool.length > 0; round++) {
    const total = pool.reduce((sum, c) => sum + c.weight, 0);
    let point = Math.floor((await uniform(seed, round)) * total);
    let index = 0;
    for (; index < pool.length - 1; index++) {
      if (point < pool[index]!.weight) break;
      point -= pool[index]!.weight;
    }
    picked.push(pool[index]!);
    pool.splice(index, 1);
  }
  return picked;
}

/**
 * Draw `count` winners. Without a seed, a random one is made and recorded;
 * with one, the draw can be repeated exactly (for a check, or a test).
 */
export async function drawWinners(
  db: Db,
  form: Form,
  options: { count: number; seed?: string; now?: Date },
): Promise<Draw> {
  if (form.definition.type !== 'giveaway') {
    throw new HelpWellError('bad_request', `${form.id} is not a giveaway`);
  }
  const count = Math.floor(options.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new HelpWellError('bad_request', 'Draw between 1 and 100 winners');
  }
  const seed = options.seed?.trim().slice(0, 128) || randomSeed();
  const candidates = await eligibleEntries(db, form.id);
  if (candidates.length === 0) {
    throw new HelpWellError('conflict', 'There are no eligible entries to draw from', {
      publicMessage: 'No trusted entries are left to draw from.',
    });
  }
  const snapshotHash = await sha256(snapshotText(candidates));
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  const picks = await weightedPicks(candidates, count, seed);
  const drawId = newId(idPrefix.draw);
  const now = (options.now ?? new Date()).toISOString();

  await db.transaction(async (tx) => {
    for (const [i, pick] of picks.entries()) {
      await tx.execute(sql`
        INSERT INTO helpwell.giveaway_winners
          (id, form_id, draw_id, entry_id, position, seed, snapshot_hash, snapshot_size,
           total_weight, status, created_at)
        VALUES (${newId(idPrefix.winner)}, ${form.id}, ${drawId}, ${pick.id}, ${i + 1}, ${seed},
                ${snapshotHash}, ${candidates.length}, ${totalWeight}, 'selected', ${now}::timestamptz)
      `);
    }
  });
  const winners = (await listWinners(db, form.id)).filter((w) => w.drawId === drawId);
  return {
    drawId,
    seed,
    snapshotHash,
    snapshotSize: candidates.length,
    totalWeight,
    winners,
  };
}

/**
 * Replace one winner, with a reason (unreachable, ineligible, declined). The
 * replacement is drawn from whoever is eligible now, seeded by the original
 * draw's seed and the redraw's number, and takes the same position.
 */
export async function redrawWinner(
  db: Db,
  form: Form,
  winnerId: string,
  reason: string,
  now: Date = new Date(),
): Promise<{ redrawn: GiveawayWinner; replacement: GiveawayWinner }> {
  const why = reason.trim().slice(0, 500);
  if (!why) throw new HelpWellError('bad_request', 'Say why this winner is being redrawn');
  const winner = (await listWinners(db, form.id)).find((w) => w.id === winnerId);
  if (!winner) throw new HelpWellError('not_found', `No winner ${winnerId}`);
  if (winner.status !== 'selected') {
    throw new HelpWellError('conflict', 'That winner was already redrawn');
  }
  const candidates = await eligibleEntries(db, form.id);
  if (candidates.length === 0) {
    throw new HelpWellError('conflict', 'There are no eligible entries left to draw from', {
      publicMessage: 'No trusted entries are left to draw from.',
    });
  }
  const previous = rowsOf<{ n: number | string }>(
    await db.execute(sql`
      SELECT count(*) AS n FROM helpwell.giveaway_winners
      WHERE draw_id = ${winner.drawId} AND replaces IS NOT NULL
    `),
  )[0];
  const seed = `${winner.seed}:redraw:${Number(previous?.n ?? 0) + 1}`;
  const [pick] = await weightedPicks(candidates, 1, seed);
  const snapshotHash = await sha256(snapshotText(candidates));
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  const id = newId(idPrefix.winner);
  const at = now.toISOString();
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO helpwell.giveaway_winners
        (id, form_id, draw_id, entry_id, position, seed, snapshot_hash, snapshot_size,
         total_weight, status, replaces, created_at)
      VALUES (${id}, ${form.id}, ${winner.drawId}, ${pick!.id}, ${winner.position}, ${seed},
              ${snapshotHash}, ${candidates.length}, ${totalWeight}, 'selected', ${winner.id},
              ${at}::timestamptz)
    `);
    await tx.execute(sql`
      UPDATE helpwell.giveaway_winners SET
        status = 'redrawn', reason = ${why}, replaced_by = ${id}, redrawn_at = ${at}::timestamptz
      WHERE id = ${winner.id}
    `);
  });
  const all = await listWinners(db, form.id);
  return {
    redrawn: all.find((w) => w.id === winner.id)!,
    replacement: all.find((w) => w.id === id)!,
  };
}

/** Every winner ever drawn, redrawn ones included, in the order they were drawn. */
export async function listWinners(db: Db, formId: string): Promise<GiveawayWinner[]> {
  const rows = rowsOf<{
    id: string;
    draw_id: string;
    entry_id: string;
    email: string | null;
    contact_id: string | null;
    entries: number | string | null;
    position: number | string;
    seed: string;
    snapshot_hash: string;
    snapshot_size: number | string;
    total_weight: number | string;
    status: 'selected' | 'redrawn';
    reason: string | null;
    replaced_by: string | null;
    replaces: string | null;
    created_at: string | Date;
    redrawn_at: string | Date | null;
  }>(
    await db.execute(sql`
      SELECT w.id, w.draw_id, w.entry_id, e.email, e.contact_id, e.entries, w.position, w.seed,
             w.snapshot_hash, w.snapshot_size, w.total_weight, w.status, w.reason, w.replaced_by,
             w.replaces, w.created_at, w.redrawn_at
      FROM helpwell.giveaway_winners w
      LEFT JOIN helpwell.giveaway_entries e ON e.id = w.entry_id
      WHERE w.form_id = ${formId}
      ORDER BY w.created_at, w.position, w.id
    `),
  );
  return rows.map((row) => ({
    id: row.id,
    drawId: row.draw_id,
    entryId: row.entry_id,
    email: row.email ?? '',
    contactId: row.contact_id,
    entries: Number(row.entries ?? 0),
    position: Number(row.position),
    seed: row.seed,
    snapshotHash: row.snapshot_hash,
    snapshotSize: Number(row.snapshot_size),
    totalWeight: Number(row.total_weight),
    status: row.status,
    reason: row.reason,
    replacedBy: row.replaced_by,
    replaces: row.replaces,
    createdAt: new Date(row.created_at),
    redrawnAt: row.redrawn_at ? new Date(row.redrawn_at) : null,
  }));
}

/** Every entry, most entries first, for the dashboard and the CSV. */
export async function listEntries(
  db: Db,
  formId: string,
  options: { limit?: number } = {},
): Promise<(GiveawayEntry & { referrals: number })[]> {
  const rows = rowsOf<EntryRow & { referrals: number | string }>(
    await db.execute(sql`
      SELECT ${ENTRY_COLUMNS},
        (SELECT count(*) FROM helpwell.giveaway_referrals r
          WHERE r.referrer_entry_id = giveaway_entries.id AND r.credited) AS referrals
      FROM helpwell.giveaway_entries
      WHERE form_id = ${formId}
      ORDER BY entries DESC, created_at
      LIMIT ${Math.max(1, Math.min(options.limit ?? 10_000, 50_000))}
    `),
  );
  return rows.map((row) => ({ ...toEntry(row), referrals: Number(row.referrals) }));
}

/** Take an entry out of (or back into) the draw, e.g. a rule breach. */
export async function setDisqualified(
  db: Db,
  formId: string,
  entryId: string,
  disqualified: boolean,
): Promise<GiveawayEntry | null> {
  await db.execute(sql`
    UPDATE helpwell.giveaway_entries SET disqualified = ${disqualified}, updated_at = now()
    WHERE id = ${entryId} AND form_id = ${formId}
  `);
  const entry = await getEntry(db, entryId);
  return entry && entry.formId === formId ? entry : null;
}

function randomSeed(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
