/**
 * Forgetting a person's form data when they are erased (CT-10).
 *
 * A submission is kept under the contact it landed on and under the address
 * typed into it, and a rejected one may have no contact at all, so both are
 * matched. Called by `deleteContact` before it clears the contact's email.
 * Giveaway winners keep their row, because a draw's record must still add
 * up, but lose the link to who it was: their entry is gone.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

export async function eraseFormData(db: Db, contactId: string): Promise<void> {
  const person = sql`(
    contact_id = ${contactId}
    OR lower(email) = (SELECT lower(email) FROM helpwell.contacts WHERE id = ${contactId} AND email IS NOT NULL)
  )`;
  await db.execute(sql`
    DELETE FROM helpwell.giveaway_referrals
    WHERE referred_entry_id IN (SELECT id FROM helpwell.giveaway_entries WHERE ${person})
  `);
  await db.execute(sql`DELETE FROM helpwell.giveaway_entries WHERE ${person}`);
  await db.execute(sql`DELETE FROM helpwell.form_submissions WHERE ${person}`);
}
