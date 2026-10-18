/**
 * Prefixed, time-sortable ids.
 *
 * Readable in logs and URLs ("cnv_m2k9x..."), sortable by creation time so a
 * cursor can be an id, and generated without a dependency. The time half is
 * millisecond precision in base36; the random half is 12 chars of crypto noise,
 * which is ~62 bits and far beyond what a single install will ever collide on.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export const idPrefix = {
  contact: 'con',
  conversation: 'cnv',
  message: 'msg',
  event: 'evt',
  gap: 'gap',
  changelog: 'chg',
  roadmap: 'rmp',
  vote: 'vot',
  impression: 'imp',
  survey: 'srv',
  search: 'sch',
  rating: 'rat',
  webhook: 'whk',
  evalRun: 'evl',
  spend: 'spn',
  block: 'blk',
  segment: 'seg',
  submission: 'fsb',
  entry: 'gve',
  referral: 'gvr',
  winner: 'gvw',
  draw: 'gvd',
} as const;

export type IdPrefix = (typeof idPrefix)[keyof typeof idPrefix];

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** `newId(idPrefix.conversation)` -> `cnv_m3k9f2a1x8qw4t` */
export function newId(prefix: IdPrefix, now = Date.now()): string {
  return `${prefix}_${now.toString(36)}${randomChars(12)}`;
}

/** The millisecond timestamp an id was minted at, or null if it is not ours. */
export function idTime(id: string): number | null {
  const body = id.split('_')[1];
  if (!body || body.length < 13) return null;
  const ms = Number.parseInt(body.slice(0, body.length - 12), 36);
  return Number.isFinite(ms) ? ms : null;
}

export function isId(value: string, prefix?: IdPrefix): boolean {
  const [p, body] = value.split('_');
  if (!p || !body) return false;
  if (prefix && p !== prefix) return false;
  return /^[0-9a-z]{13,}$/.test(body);
}
